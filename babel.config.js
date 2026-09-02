module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          alias: {
            '@core': './src/core',
            '@components': './src/components',
            '@screens': './src/screens',
            '@hooks': './src/hooks',
            '@platform': './src/platform',
            '@theme': './src/theme',
          },
        },
      ],
    ],
  };
};
