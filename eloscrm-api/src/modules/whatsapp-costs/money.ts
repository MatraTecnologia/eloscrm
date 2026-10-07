import { Prisma } from "../../generated/prisma/client.js";
// Mantém até 40 dígitos significativos nos produtos/somas sem mudar o Decimal global do CRM.
export const CostDecimal = Prisma.Decimal.clone({ precision: 40 });
