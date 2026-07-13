import type { RouterOutputs } from "../../server/root";

export type PaymentLink = NonNullable<RouterOutputs["paymentLinks"]["get"]>;
