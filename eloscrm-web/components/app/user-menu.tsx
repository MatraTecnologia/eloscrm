"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient, useSession } from "@/lib/auth-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SidebarMenuButton } from "@/components/ui/sidebar";

const initials = (name?: string | null) =>
  (name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export const UserMenu = () => {
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user;

  const logout = async () => {
    await authClient.signOut();
    router.replace("/login");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarMenuButton size="lg" className="text-sidebar-foreground hover:bg-sidebar-accent" />}
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
            {initials(user?.name)}
          </AvatarFallback>
        </Avatar>
        <div className="grid flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{user?.name ?? "Usuário"}</span>
          <span className="truncate text-xs opacity-70">{user?.email}</span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Minha conta</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout}>
          <LogOut className="size-4" /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
