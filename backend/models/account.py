"""Account-specific persistence models."""
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from database.db import Base
from models.models import utcnow

class AccountActivity(Base):
    __tablename__ = "account_activities"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    activity_type = Column(String(30), nullable=False, index=True)
    target_type = Column(String(20), nullable=True)
    target_id = Column(Integer, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
