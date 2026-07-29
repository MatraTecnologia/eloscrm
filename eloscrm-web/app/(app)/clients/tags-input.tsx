'use client'

import { X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

export const TagsInput = ({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) => {
  const [draft, setDraft] = useState('')

  const add = () => {
    const tag = draft.trim()
    // duplicada não é erro do usuário, é só ruído: ignora em silêncio e limpa o campo
    if (tag && !value.includes(tag)) onChange([...value, tag])
    setDraft('')
  }

  return (
    <div className="space-y-2">
      <Input
        id="tags"
        placeholder="Digite e pressione Enter"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          // Enter dentro de um dialog submeteria o formulário; aqui ele só fecha a tag
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
      />
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(tag => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button
                type="button"
                aria-label={`Remover ${tag}`}
                onClick={() => onChange(value.filter(t => t !== tag))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
