import config from "@figuredev/eslint-config-node"

export default [
    ...config,
    {
        ignores: ["lib/**", "scripts/**", "tests/**", "__tests__/**"],
    },
    {
        rules: {
            "func-style": ["error", "declaration", { allowArrowFunctions: true }],
            "lines-between-class-members": "off",
            "no-nested-ternary": "off",
            "no-shadow": "off",
            "@typescript-eslint/no-inferrable-types": "off",
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/explicit-module-boundary-types": "off",
        },
    },
]
