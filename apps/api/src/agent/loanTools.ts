import { z } from "zod";
import { defineTool, ToolError } from "./tool.js";

// DEMO DATA: invented products and rates for learning. Not any real lender's offering.
export const LOAN_PRODUCTS = [
  {
    id: "sme-working-capital",
    name: "SME Working Capital",
    purposes: ["business"],
    annualRatePercent: 30,
    minAmount: 100_000,
    maxAmount: 5_000_000,
    minTenorMonths: 3,
    maxTenorMonths: 12,
  },
  {
    id: "school-fees",
    name: "School Fees Loan",
    purposes: ["education"],
    annualRatePercent: 24,
    minAmount: 50_000,
    maxAmount: 2_000_000,
    minTenorMonths: 3,
    maxTenorMonths: 10,
  },
  {
    id: "personal",
    name: "Personal Loan",
    purposes: ["personal", "medical", "rent", "other"],
    annualRatePercent: 36,
    minAmount: 20_000,
    maxAmount: 1_000_000,
    minTenorMonths: 1,
    maxTenorMonths: 12,
  },
] as const;

type ProductId = (typeof LOAN_PRODUCTS)[number]["id"];
const PRODUCT_IDS = LOAN_PRODUCTS.map((p) => p.id) as [ProductId, ...ProductId[]];
const PURPOSES = ["business", "education", "personal", "medical", "rent", "other"] as const;

export const getLoanProducts = defineTool({
  name: "get_loan_products",
  description:
    "List available loan products with interest rates and amount/tenor limits (NGN). " +
    "Filter by purpose, or pass null to list all products.",
  parameters: z.object({
    purpose: z.enum(PURPOSES).nullable(),
  }),
  execute: ({ purpose }) =>
    LOAN_PRODUCTS.filter(
      (p) => purpose === null || (p.purposes as readonly string[]).includes(purpose),
    ),
});

export const calculateRepayment = defineTool({
  name: "calculate_repayment",
  description:
    "Calculate the fixed monthly repayment, total repayment and total interest for a loan " +
    "product. Always use this for repayment figures instead of doing the maths yourself.",
  parameters: z.object({
    productId: z.enum(PRODUCT_IDS),
    amount: z.number().positive().describe("Loan amount in NGN"),
    tenorMonths: z.number().int().positive(),
  }),
  execute: ({ productId, amount, tenorMonths }) => {
    // Takes a productId, not a rate: the model can't invent an interest rate, and the
    // tool enforces the product's limits (business rules live in code, not the prompt).
    const product = LOAN_PRODUCTS.find((p) => p.id === productId)!;

    if (amount < product.minAmount || amount > product.maxAmount) {
      throw new ToolError(
        `${product.name} amounts must be between ₦${product.minAmount.toLocaleString()} and ₦${product.maxAmount.toLocaleString()}.`,
      );
    }
    if (tenorMonths < product.minTenorMonths || tenorMonths > product.maxTenorMonths) {
      throw new ToolError(
        `${product.name} tenor must be ${product.minTenorMonths}-${product.maxTenorMonths} months.`,
      );
    }

    const monthlyPayment = amortizedMonthlyPayment(amount, product.annualRatePercent, tenorMonths);
    const totalRepayment = monthlyPayment * tenorMonths;
    return {
      productId,
      amount,
      tenorMonths,
      annualRatePercent: product.annualRatePercent,
      monthlyPayment: roundToKobo(monthlyPayment),
      totalRepayment: roundToKobo(totalRepayment),
      totalInterest: roundToKobo(totalRepayment - amount),
    };
  },
});

export const LOAN_TOOLS = [getLoanProducts, calculateRepayment];

/** Standard amortization: equal monthly payments covering interest and principal. */
export function amortizedMonthlyPayment(amount: number, annualRatePercent: number, months: number) {
  const monthlyRate = annualRatePercent / 100 / 12;
  if (monthlyRate === 0) return amount / months;
  return (amount * monthlyRate) / (1 - (1 + monthlyRate) ** -months);
}

// Floats are fine for a demo estimate. Production money code uses integer kobo or a decimal library.
function roundToKobo(naira: number) {
  return Math.round(naira * 100) / 100;
}

export const LOAN_AGENT_PROMPT = `You are a loan assistant for a demo lender. Amounts are in NGN (₦).
- Use get_loan_products to find suitable products. Never invent products, rates or limits.
- Use calculate_repayment for every repayment figure. Never do the arithmetic yourself.
- If a request is outside a product's limits, say so and suggest what is possible.
- Keep answers short, and say that figures are estimates.`;
