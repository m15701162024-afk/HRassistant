FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir openpyxl
COPY server.py ./server.py
COPY static ./static
COPY templates ./templates

ENV RECRUITMENT_HOST=0.0.0.0
ENV RECRUITMENT_PORT=8787
ENV RECRUITMENT_DB=/data/recruitment_history.db

EXPOSE 8787
VOLUME ["/data"]

CMD ["python", "server.py"]
