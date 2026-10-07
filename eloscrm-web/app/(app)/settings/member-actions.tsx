'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Props = {
  memberId: string
  organizationId: string
  name: string
  role: string
  onSaved: () => void
}

export const MemberActions = ({ memberId, organizationId, name, role, onSaved }: Props) => {
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const updateRole = async (nextRole: string | null) => {
    if (nextRole !== 'admin' && nextRole !== 'member') return
    setBusy(true)
    try {
      const result = await authClient.organization.updateMemberRole({ memberId, organizationId, role: nextRole })
      if (result.error) {
        toast.error('Não foi possível alterar o papel')
        return
      }
      onSaved()
      toast.success('Papel atualizado')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      const result = await authClient.organization.removeMember({ memberIdOrEmail: memberId, organizationId })
      if (result.error) {
        toast.error('Não foi possível remover o membro')
        return
      }
      setConfirmOpen(false)
      onSaved()
      toast.success('Membro removido')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={role} onValueChange={updateRole} disabled={busy}>
        <SelectTrigger aria-label={`Papel de ${name}`} className="w-40">
          <SelectValue>{value => value === 'admin' ? 'Administrador' : 'Corretor'}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="member">Corretor</SelectItem>
          <SelectItem value="admin">Administrador</SelectItem>
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmOpen(true)}>Remover</Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remover {name}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Este membro perderá o acesso ao workspace.</p>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button variant="destructive" disabled={busy} onClick={remove}>{busy ? 'Removendo…' : 'Remover membro'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
