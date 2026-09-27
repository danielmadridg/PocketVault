/**
 * Firestore 12 bundles re2js (~250 KB) only to evaluate the regex operators of
 * its Pipelines API against the local cache. PocketVault never runs pipelines,
 * so vite.config.ts aliases `re2js` to this native-RegExp stand-in.
 */
export const RE2JS = {
  compile(pattern: string) {
    const contains = new RegExp(pattern, 'u');
    const whole = new RegExp(`^(?:${pattern})$`, 'u');
    return {
      test: (input: string) => contains.test(input),
      matches: (input: string) => whole.test(input),
    };
  },
};
