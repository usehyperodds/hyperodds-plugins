const swc = [
  "@swc/jest",
  { jsc: { transform: { react: { runtime: "automatic", importSource: "@metamask/snaps-sdk" } } } },
];

module.exports = {
  preset: "@metamask/snaps-jest",
  testMatch: ["<rootDir>/src/**/*.test.ts?(x)"],
  transform: { "^.+\\.(t|j)sx?$": swc },
  // Parts of the Snaps stack ship as ESM only; Jest 29 needs them compiled to CommonJS.
  transformIgnorePatterns: ["/node_modules/(?!(@metamask|lodash-es)/)(?!.*/node_modules/)"],
};
