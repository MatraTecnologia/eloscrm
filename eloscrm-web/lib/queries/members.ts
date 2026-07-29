import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useActiveOrganization } from "@/lib/auth-client";
import type { Member } from "@/lib/types";

export const useMembers = () => {
  const { data: org } = useActiveOrganization();
  return useQuery({
    queryKey: ["members", org?.id],
    queryFn: async () => {
      const { data } = await api.get<Member[]>("/members");
      return data;
    },
    enabled: !!org?.id,
  });
};
