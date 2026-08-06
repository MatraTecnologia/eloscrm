"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Building2,
  Calendar,
  Handshake,
  LayoutDashboard,
  MessageSquare,
  ScrollText,
  Settings,
  Snowflake,
  Users,
} from "lucide-react";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useSession } from "@/lib/auth-client";
import { useMembers } from "@/lib/queries/members";
import { OrgSwitcher } from "./org-switcher";
import { UserMenu } from "./user-menu";

const items = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Clientes", href: "/clients", icon: Users },
  { title: "Negociações", href: "/deals", icon: Handshake },
  { title: "Nutrição", href: "/nurturing", icon: Snowflake },
  { title: "Imóveis", href: "/properties", icon: Building2 },
  { title: "Agenda", href: "/agenda", icon: Calendar },
  { title: "Conversas", href: "/conversas", icon: MessageSquare },
  { title: "WhatsApp", href: "/integracoes/whatsapp", icon: WhatsappIcon },
  { title: "Configurações", href: "/settings", icon: Settings },
];

// Só quem gerencia a imobiliária consulta a trilha da equipe — o gate real é a API (403 para
// `member`), este é só o item de menu, mesmo padrão de gate de `comment-feed.tsx`.
const managerItem = { title: "Auditoria", href: "/auditoria", icon: ScrollText };

export const AppSidebar = () => {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { data: members } = useMembers();
  const myRole = members?.find((member) => member.userId === session?.user.id)?.role ?? null;
  const isManager = myRole === "owner" || myRole === "admin";

  const menuItems = isManager ? [...items, managerItem] : items;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/dashboard" className="flex items-center gap-2 px-2 py-1.5">
          <Image src="/logo-white.svg" alt="elosCRM" width={116} height={35} priority style={{ height: "auto" }} />
        </Link>
        <OrgSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton render={<Link href={item.href} />} isActive={active} tooltip={item.title}>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  );
};
