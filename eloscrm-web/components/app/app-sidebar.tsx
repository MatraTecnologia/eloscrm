"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  Building2,
  Calendar,
  Handshake,
  LayoutDashboard,
  MessageCircle,
  MessageSquare,
  Settings,
  Snowflake,
  Users,
} from "lucide-react";
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
  { title: "WhatsApp", href: "/integracoes/whatsapp", icon: MessageCircle },
  { title: "Configurações", href: "/settings", icon: Settings },
];

export const AppSidebar = () => {
  const pathname = usePathname();

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
              {items.map((item) => {
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
