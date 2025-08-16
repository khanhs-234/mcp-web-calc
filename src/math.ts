import { create, all } from "mathjs";

export type NumberMode = "number" | "BigNumber" | "Fraction";

export interface MathResult {
  mode: NumberMode;
  result: string;
  valueType: string;
}

export function evaluateExpression(expr: string, mode: NumberMode = "BigNumber", precision = 64): MathResult {
  const math = create(all, {});
  if (mode === "BigNumber") math.config({ number: "BigNumber", precision });
  else if (mode === "Fraction") math.config({ number: "Fraction" });
  else math.config({ number: "number" });
  const v = (math as any).evaluate(expr);
  const valueType = (v && typeof v === "object" && (v as any).constructor) ? (v as any).constructor.name : typeof v;
  return { mode, result: (math as any).format(v, { precision }), valueType };
}
