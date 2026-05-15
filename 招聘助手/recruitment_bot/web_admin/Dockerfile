FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir openpyxl
COPY web_admin/server.py ./server.py
COPY web_admin/static ./static
COPY web_admin/templates ./templates
COPY web_admin/security_allowlist.json ./security_allowlist.json
COPY browser-extension ./browser-extension

ENV RECRUITMENT_HOST=0.0.0.0
ENV RECRUITMENT_PORT=8787
ENV RECRUITMENT_DB=/data/recruitment_history.db
ENV RECRUITMENT_EXTENSION_DIR=/app/browser-extension

EXPOSE 8787
VOLUME ["/data"]

CMD ["python", "server.py"]
