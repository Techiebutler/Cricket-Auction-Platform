"""S3 upload service for profile photos and other assets."""
import logging
import uuid
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


def upload_file(content: bytes, key_prefix: str = "profile", content_type: str = "image/jpeg") -> Optional[str]:
    """Upload bytes to S3. Returns public URL or None if S3 not configured."""
    if not settings.s3_enabled:
        return None

    try:
        import boto3
        from botocore.exceptions import ClientError

        ext = "jpg" if "jpeg" in content_type or "jpg" in content_type else "png"
        key = f"{key_prefix}/{uuid.uuid4()}.{ext}"

        key_id = settings.AWS_ACCESS_KEY_ID or settings.AWS_MAIL_ACCESS_KEY_ID
        secret = settings.AWS_SECRET_ACCESS_KEY or settings.AWS_MAIL_SECRET_ACCESS_KEY
        bucket = settings.AWS_BUCKET_NAME

        s3 = boto3.client(
            "s3",
            aws_access_key_id=key_id,
            aws_secret_access_key=secret,
            region_name=settings.AWS_REGION,
        )

        s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=content,
            ContentType=content_type,
            ACL="public-read",
        )

        url = f"https://{bucket}.s3.{settings.AWS_REGION}.amazonaws.com/{key}"
        return url
    except ClientError as e:
        logger.exception("S3 upload failed: %s", e)
        return None
    except Exception as e:
        logger.exception("S3 upload error: %s", e)
        return None
