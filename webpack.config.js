const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  
  return {
    entry: './src/index.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProduction ? '[name].[contenthash].js' : 'bundle.js',
      clean: true,
      publicPath: '/'
    },
    module: {
      rules: [
        {
          test: /\.jsx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-react']
            }
          }
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        }
      ]
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './public/index.html',
        filename: 'index.html'
      }),
      // Add DefinePlugin to provide process.env in the browser
      new webpack.DefinePlugin({
        'process.env': JSON.stringify({
          NODE_ENV: isProduction ? 'production' : 'development',
          REACT_APP_APESCAN_API_KEY: process.env.REACT_APP_APESCAN_API_KEY || '8AIZVW9PAGT3UY6FCGRZFDJ51SZGDIG13X'
        })
      })
    ],
    devServer: {
      static: {
        directory: path.join(__dirname, 'dist'),
      },
      compress: true,
      port: 3000,
      historyApiFallback: true,
      open: true,
      hot: true
    },
    resolve: {
      extensions: ['.js', '.jsx'],
      fallback: {
        // Add fallbacks for Node.js modules that aren't available in browsers
        "process": require.resolve("process/browser"),
        "buffer": require.resolve("buffer"),
        "util": require.resolve("util"),
        "stream": require.resolve("stream-browserify"),
        "crypto": require.resolve("crypto-browserify"),
        "vm": require.resolve("vm-browserify")
      }
    }
  };
};