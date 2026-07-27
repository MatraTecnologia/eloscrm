'use client'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { clientSourceLabels, formatPhone, toE164 } from '@/lib/labels'
import { useCreateClient, useUpdateClient } from '@/lib/queries/clients'
import type { Client, ClientSource } from '@/lib/types'
import { useState } from 'react'
import { toast } from 'sonner'

export const ClientDialog = ({
  client,
  trigger,
}: {
  client?: Client
  trigger: React.ReactNode
}) => {
  const editing = !!client
  const create = useCreateClient()
  const update = useUpdateClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(client?.name ?? '')
  const [email, setEmail] = useState(client?.email ?? '')
  // state guarda o telefone já mascarado; a conversão para E.164 acontece só no submit
  const [phone, setPhone] = useState(formatPhone(client?.phone))
  const [source, setSource] = useState<ClientSource>(client?.source ?? 'OUTROS')
  const [notes, setNotes] = useState(client?.notes ?? '')

  const saving = create.isPending || update.isPending

  // o state só nasce na montagem e o dialog não desmonta ao fechar: sem isto, reabrir traz o
  // rascunho anterior (ou dados desatualizados do cliente, se ele mudou nesse meio-tempo)
  const onOpenChange = (next: boolean) => {
    if (next) {
      setName(client?.name ?? '')
      setEmail(client?.email ?? '')
      setPhone(formatPhone(client?.phone))
      setSource(client?.source ?? 'OUTROS')
      setNotes(client?.notes ?? '')
    }
    setOpen(next)
  }

  const submit = async () => {
    if (!name.trim()) return
    const input = {
      name: name.trim(),
      email: email.trim() || undefined,
      phone: toE164(phone),
      source,
      notes: notes.trim() || undefined,
    }
    try {
      if (editing) await update.mutateAsync({ id: client.id, input })
      else await create.mutateAsync(input)
      toast.success(editing ? 'Cliente atualizado' : 'Cliente criado')
      setOpen(false)
    } catch {
      toast.error('Não foi possível salvar o cliente')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={trigger as React.ReactElement<Record<string, unknown>>}
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? 'Editar cliente' : 'Novo cliente'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              placeholder="Nome completo"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="email@exemplo.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Telefone</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                placeholder="(00) 00000-0000"
                value={phone}
                onChange={e => setPhone(formatPhone(e.target.value))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Origem</Label>
            <Select
              value={source}
              onValueChange={v => setSource(v as ClientSource)}
            >
              <SelectTrigger className="w-full">
                {/* sem a função, o Base UI mostra o valor cru do enum (OUTROS em vez de Outros) */}
                <SelectValue>
                  {(v: ClientSource) => clientSourceLabels[v]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(clientSourceLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              rows={4}
              placeholder="Preferências, imóveis de interesse, melhor horário de contato…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !name.trim()}>
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
