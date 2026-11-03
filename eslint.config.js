const js = require('@eslint/js');
const globals = require('globals');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const importPlugin = require('eslint-plugin-import');
const reactPlugin = require('eslint-plugin-react');
const reactHooksPlugin = require('eslint-plugin-react-hooks');
const jsxA11yPlugin = require('eslint-plugin-jsx-a11y');

module.exports = [
  { ignores: ['build/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  ...[
    ...tsPlugin.configs['flat/recommended'],
    importPlugin.flatConfigs.recommended,
    importPlugin.flatConfigs.typescript,
    reactPlugin.configs.flat.recommended,
    reactHooksPlugin.configs['recommended-latest'],
    jsxA11yPlugin.flatConfigs.recommended,
    {
      languageOptions: {
        globals: { ...globals.node, ...globals.browser },
      },
    },
  ].map((config) => ({ ...config, files: ['**/*.ts', '**/*.tsx'] })),
];
