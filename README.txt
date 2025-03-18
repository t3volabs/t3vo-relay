docker run -d \
  --name t3vo-relay \
  --restart unless-stopped \
  -p 57301:57301 \
  ghcr.io/t3volabs/t3vo-relay:main
