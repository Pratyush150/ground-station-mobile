module.exports = {
  root: true,
  extends: ['expo', 'prettier'],
  plugins: ['prettier'],
  ignorePatterns: ['node_modules/', 'dist/', '.expo/', 'coverage/'],
  rules: {
    'prettier/prettier': 'warn',
    // The core layer must stay framework-free: it is the part that is
    // typechecked and tested without the React Native toolchain installed.
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['react', 'react-native', 'react-native-*', 'expo', 'expo-*'],
            message: 'src/core must not import UI frameworks.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      files: [
        'src/components/**',
        'src/screens/**',
        'src/hooks/**',
        'src/navigation/**',
        'src/platform/**',
        'App.tsx',
        'index.ts',
      ],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
};
