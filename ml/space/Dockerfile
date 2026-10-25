FROM python:3.11-slim
RUN useradd -m -u 1000 user
WORKDIR /home/user/app
RUN pip install --no-cache-dir onnxruntime==1.31.0 tokenizers==0.23.3 numpy fastapi==0.115.* "uvicorn[standard]==0.32.*"
COPY --chown=user . .
USER user
EXPOSE 7860
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
