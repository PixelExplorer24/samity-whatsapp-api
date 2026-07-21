FROM wppconnect/wppconnect-server:latest

ENV PORT=8080
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV WA_PORT=8080

EXPOSE 8080

CMD ["node", "dist/index.js"]
