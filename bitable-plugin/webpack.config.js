/** 飞书多维表格插件 webpack 配置（精简版，不依赖 block-bitable-webpack-utils）。
 *
 * 关键点：
 * 1. 用普通 webpack 5 配置
 * 2. entry 是插件的 React 根组件
 * 3. 输出格式：每个 view 一个 JS bundle
 * 4. 飞书插件运行时通过 window.bitable 注入，不需要特殊 webpack 插件
 */
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { VueLoaderPlugin } = require('vue-loader');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';

  return {
    mode: isProd ? 'production' : 'development',
    entry: {
      main: './src/index.tsx',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.vue'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env', '@babel/preset-react', '@babel/preset-typescript'],
            },
          },
        },
        {
          test: /\.vue$/,
          loader: 'vue-loader',
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
        {
          test: /\.(png|jpg|jpeg|gif|svg)$/,
          type: 'asset/resource',
        },
      ],
    },
    plugins: [
      new VueLoaderPlugin(),
      new HtmlWebpackPlugin({
        template: './public/index.html',
        filename: 'index.html',
      }),
    ],
    devServer: {
      port: 8080,
      hot: true,
      open: false,
      headers: {
        'Access-Control-Allow-Origin': '*',
      },
    },
    devtool: isProd ? false : 'eval-source-map',
  };
};
