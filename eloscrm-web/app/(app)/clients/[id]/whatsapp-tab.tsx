"use client";
import { ClientInbox } from "@/components/whatsapp-official/client-inbox";

export const WhatsappTab = ({ clientId }: { clientId: string }) => <ClientInbox clientId={clientId} />;
