"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { authClient, useActiveOrganization } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const roleLabels: Record<string, string> = {
  owner: "Dono",
  admin: "Gestor",
  member: "Corretor",
};

const invitationStatusLabels: Record<string, string> = {
  pending: "Pendente",
  accepted: "Aceito",
  rejected: "Recusado",
  canceled: "Cancelado",
};

type InviteRole = "member" | "admin";

const InviteMemberDialog = () => {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("member");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!email.trim()) return;
    setSaving(true);
    const res = await authClient.organization.inviteMember({ email: email.trim(), role });
    setSaving(false);
    if (res.error) {
      toast.error("Não foi possível enviar o convite");
      return;
    }
    setEmail("");
    setRole("member");
    setOpen(false);
    toast.success("Convite enviado");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <UserPlus className="size-4" /> Convidar membro
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar membro</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">E-mail</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="pessoa@imobiliaria.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Papel</Label>
            <Select value={role} onValueChange={(v) => setRole(v as InviteRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Corretor</SelectItem>
                <SelectItem value="admin">Gestor</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving || !email.trim()}>
            {saving ? "Enviando…" : "Enviar convite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default function SettingsPage() {
  const { data: org, isPending } = useActiveOrganization();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-muted-foreground">Dados da imobiliária e membros da equipe.</p>
      </div>

      {!isPending && !org && (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          Selecione ou crie uma imobiliária.
        </div>
      )}

      {org && (
        <>
          <div className="space-y-2">
            <h2 className="text-lg font-medium">Imobiliária</h2>
            <div className="grid max-w-lg grid-cols-2 gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label>Nome</Label>
                <p className="text-sm">{org.name}</p>
              </div>
              <div className="space-y-1">
                <Label>Slug</Label>
                <p className="text-sm text-muted-foreground">{org.slug}</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-medium">Membros</h2>
              <InviteMemberDialog />
            </div>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Membro</TableHead>
                    <TableHead>Papel</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {org.members.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={2} className="py-10 text-center text-muted-foreground">
                        Nenhum membro ainda.
                      </TableCell>
                    </TableRow>
                  )}
                  {org.members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar size="sm">
                            <AvatarFallback>{member.user.name?.[0]?.toUpperCase() ?? "?"}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{member.user.name}</p>
                            <p className="text-xs text-muted-foreground">{member.user.email}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{roleLabels[member.role] ?? member.role}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {org.invitations.filter((invitation) => invitation.status === "pending").length > 0 && (
            <div className="space-y-2">
              <h2 className="text-lg font-medium">Convites pendentes</h2>
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>E-mail</TableHead>
                      <TableHead>Papel</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {org.invitations
                      .filter((invitation) => invitation.status === "pending")
                      .map((invitation) => (
                        <TableRow key={invitation.id}>
                          <TableCell>{invitation.email}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{roleLabels[invitation.role] ?? invitation.role}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {invitationStatusLabels[invitation.status] ?? invitation.status}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
