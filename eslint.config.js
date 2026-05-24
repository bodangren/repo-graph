import boundaries from "eslint-plugin-boundaries";

export default [
  {
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/include": ["graphing-tools/**/*", "measure/**/*"],
      "boundaries/elements": [
        {
          type: "tools",
          pattern: "graphing-tools/*",
        },
        {
          type: "measure",
          pattern: "measure/*",
        },
      ],
    },
    rules: {
      "boundaries/no-unknown": ["error"],
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            {
              from: "tools",
              allow: ["tools"],
            },
            {
              from: "measure",
              allow: ["measure"],
            },
          ],
        },
      ],
    },
  },
];
