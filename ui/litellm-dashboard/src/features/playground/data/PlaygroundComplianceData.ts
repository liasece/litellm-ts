import Framework01 from "./compliance/Framework01Data";
import Framework02 from "./compliance/Framework02Data";
import Framework03 from "./compliance/Framework03Data";
import Framework04 from "./compliance/Framework04Data";
import Framework05 from "./compliance/Framework05Data";
import Framework06 from "./compliance/Framework06Data";
import Framework07 from "./compliance/Framework07Data";
import Framework08 from "./compliance/Framework08Data";
import { complianceFrameworkSchema } from "../support/PlaygroundComplianceModels";
/** Original 998 prompt dataset, grouped by framework/category without altering prompt text. */
export const complianceFrameworks = [
	Framework01,
	Framework02,
	Framework03,
	Framework04,
	Framework05,
	Framework06,
	Framework07,
	Framework08,
].map((value) => complianceFrameworkSchema.parse(value));
