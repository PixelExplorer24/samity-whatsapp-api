FROM ivanbeldad/wppconnect-server:latest

ENV PORT=8080
ENV WA_PORT=8080

EXPOSE 8080

CMD ["npm", "run", "start"]
