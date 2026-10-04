export const trainingPrescriptionSchema: {
  parse(value: unknown): any;
  safeParse(value: unknown): { success: boolean; data?: any; error?: unknown };
};
