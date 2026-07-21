FROM wppconnect/wppconnect-server:latest
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "start"]
