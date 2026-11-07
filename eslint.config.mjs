import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The admin assistant (src/lib/assistant) may only read. Gemini decides
  // which of its tools run, so nothing in that folder may be able to write,
  // send an SMS, print or call a function. See docs/ai-assistant-context.md.
  {
    files: ["src/lib/assistant/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "firebase/firestore",
              importNames: [
                "setDoc",
                "updateDoc",
                "addDoc",
                "deleteDoc",
                "writeBatch",
                "runTransaction",
                "increment",
                "arrayUnion",
                "arrayRemove",
                "deleteField",
                "serverTimestamp",
                "onSnapshot",
              ],
              message: "src/lib/assistant is read-only: use getDocs/getDoc only.",
            },
            { name: "firebase/functions", message: "src/lib/assistant must not call Cloud Functions." },
            { name: "firebase/storage", message: "src/lib/assistant must not touch Storage." },
            { name: "firebase/auth", message: "src/lib/assistant must not change sign-in." },
            { name: "@/lib/sms", message: "src/lib/assistant must not send SMS." },
            { name: "@/lib/printer", message: "src/lib/assistant must not print." },
            { name: "@/lib/receipts", message: "src/lib/assistant must not print." },
            { name: "@/lib/billNumbers", message: "src/lib/assistant must not take bill numbers." },
          ],
          patterns: [
            {
              group: ["@/lib/firestore/*", "**/lib/firestore/*"],
              message: "Those modules hold writes. The assistant reads through its own source.ts.",
            },
            { group: ["firebase-admin", "firebase-admin/*"], message: "Not in the browser." },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
