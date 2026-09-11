# Il servizio unico di produzione (render.yaml): Node per il proxy, Ruby
# per il tavolo (l'engine), nello stesso contenitore. Niente build: il
# server è JavaScript nudo, l'engine è Ruby senza gemme.
FROM ruby:3.2-slim
RUN apt-get update && apt-get install -y --no-install-recommends nodejs && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY engine ./engine
COPY data ./data
COPY scripts/server.mjs ./scripts/
ENV PORT=10000 ENGINE_PORT=8788
EXPOSE 10000
CMD ["node", "scripts/server.mjs"]
