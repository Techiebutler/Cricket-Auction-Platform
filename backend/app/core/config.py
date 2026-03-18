from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # App
    SECRET_KEY: str = "changeme-in-production"
    GODMODE_SECRET: str = "GODMODE_CHANGEME"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24h
    UPLOAD_DIR: str = "/app/uploads"
    
    # Site URL for email links (no trailing slash)
    SITE_URL: str = "http://localhost"

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://auction:auction@db:5432/auction"

    # Redis
    REDIS_URL: str = "redis://redis:6379"

    # AWS SES
    AWS_MAIL_ACCESS_KEY_ID: Optional[str] = None
    AWS_MAIL_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_REGION: str = "ap-south-1"
    EMAIL_FROM: str = "auction@yourdomain.com"

    # AWS S3 (reuse AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY if set, else fall back to SES creds)
    AWS_ACCESS_KEY_ID: Optional[str] = None
    AWS_SECRET_ACCESS_KEY: Optional[str] = None
    AWS_BUCKET_NAME: Optional[str] = None

    @property
    def email_enabled(self) -> bool:
        return bool(self.AWS_MAIL_ACCESS_KEY_ID and self.AWS_MAIL_SECRET_ACCESS_KEY)

    @property
    def s3_enabled(self) -> bool:
        key = self.AWS_ACCESS_KEY_ID or self.AWS_MAIL_ACCESS_KEY_ID
        secret = self.AWS_SECRET_ACCESS_KEY or self.AWS_MAIL_SECRET_ACCESS_KEY
        return bool(key and secret and self.AWS_BUCKET_NAME)

    class Config:
        env_file = ".env"


settings = Settings()
