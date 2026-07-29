import * as repo from "./members.repo.js";

// achata o join: o front quer userId direto para casar com ownerId, não um objeto aninhado
export const list = async (orgId: string) => {
  const members = await repo.listMembers(orgId);
  return members.map((member) => ({
    userId: member.user.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
  }));
};
