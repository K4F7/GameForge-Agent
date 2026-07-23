import { verifyHarnessDependencyReview } from "../src/dependency-review.js";

const result = await verifyHarnessDependencyReview();
process.stdout.write(`Verified ${result.verified} UI harness runtime dependencies.\n`);
