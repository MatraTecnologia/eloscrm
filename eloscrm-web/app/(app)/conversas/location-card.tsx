"use client";

import { ExternalLink, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SharedLocation } from "@/lib/types";

/**
 * Localização compartilhada.
 *
 * O corretor recebe isto quando o cliente manda onde mora, onde trabalha ou o imóvel que viu passando
 * — e o que ele faz em seguida é abrir no mapa para ver a região. Por isso o cartão inteiro é o link:
 * o mapa estático que veio no próprio webhook serve de prévia, e o toque leva ao Google Maps.
 *
 * `name` e `address` só existem quando o que foi compartilhado é um lugar; ponto solto no mapa vem
 * com as coordenadas e nada mais, e aí o cartão diz o que é sem inventar endereço.
 *
 * `location` nulo é o caso das mensagens ingeridas antes de a localização ser lida: o mapa estático
 * ficou no banco, as coordenadas não. O cartão mostra o que sobrou e deixa de ser link — melhor que
 * uma bolha vazia, e melhor que um link para lugar nenhum.
 */
export const LocationCard = ({
  location,
  thumb,
  mine,
}: {
  location: SharedLocation | null;
  /** mapa estático que veio no webhook, em base64 */
  thumb: string | null;
  mine: boolean;
}) => {
  const Wrapper = location ? "a" : "span";
  const link = location
    ? {
        href: `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`,
        target: "_blank",
        rel: "noreferrer",
      }
    : {};

  return (
    <Wrapper
      {...link}
      className={cn(
        "block w-64 overflow-hidden rounded-md sm:w-72",
        location && "transition-opacity hover:opacity-90",
        mine ? "bg-primary-foreground/15" : "bg-background/60",
      )}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/jpeg;base64,${thumb}`}
          alt="Mapa da localização"
          className="h-32 w-full object-cover"
        />
      ) : (
        <span className="bg-current/10 flex h-32 w-full items-center justify-center">
          <MapPin className="size-8 opacity-60" />
        </span>
      )}

      <span className="flex items-start gap-2 p-2">
        <MapPin className="mt-0.5 size-4 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {location?.name ?? "Localização"}
          </span>
          {location && (
            <span className="block text-xs opacity-70">
              {location.address ??
                // sem endereço, as coordenadas são a única identificação honesta do ponto
                `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`}
            </span>
          )}
        </span>
        {location && <ExternalLink className="mt-0.5 size-3.5 shrink-0 opacity-50" />}
      </span>
    </Wrapper>
  );
};
