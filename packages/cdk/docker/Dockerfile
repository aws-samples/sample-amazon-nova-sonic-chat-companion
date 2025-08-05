# app/Dockerfile

FROM public.ecr.aws/docker/library/node:23-slim

USER node
WORKDIR /opt/app
COPY dist dist
COPY public public
COPY package.json package.json
RUN npm install
ENV PROD=1
EXPOSE 3000

HEALTHCHECK CMD curl --fail http://localhost:3000/health

ENTRYPOINT ["npm", "run", "start"]
