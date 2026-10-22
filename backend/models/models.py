"""
نماذج قاعدة البيانات (SQLAlchemy ORM Models) لمشروع Ytrana.
تشمل: users, posts, comments, likes, followers, notifications, reports
"""
import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime,
    ForeignKey, UniqueConstraint, Index, Enum as SAEnum
)
from sqlalchemy.orm import relationship

from database.db import Base


def utcnow():
    return datetime.now(timezone.utc)


def utcnow_naive():
    """وقت UTC بلا tzinfo للأعمدة القديمة المعرفة كـ DateTime دون timezone."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(30), unique=True, nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    full_name = Column(String(100), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    bio = Column(String(160), default="", nullable=False)
    avatar_url = Column(String(255), nullable=True)

    is_active = Column(Boolean, default=True, nullable=False)     # حساب مفعّل
    is_banned = Column(Boolean, default=False, nullable=False)    # محظور من الإدارة
    is_admin = Column(Boolean, default=False, nullable=False)
    verified_at = Column(DateTime(timezone=True), nullable=True)
    verification_expires_at = Column(DateTime(timezone=True), nullable=True)
    frozen_at = Column(DateTime(timezone=True), nullable=True)
    frozen_until = Column(DateTime(timezone=True), nullable=True)
    # Narrow, individually enforced privacy controls (not a blanket private-account claim).
    is_private = Column(Boolean, default=False, nullable=False, index=True)
    account_visibility = Column(String(20), default="public", nullable=False, index=True)
    message_privacy = Column(String(20), default="everyone", nullable=False)
    comment_privacy = Column(String(20), default="everyone", nullable=False)
    show_activity_status = Column(Boolean, default=True, nullable=False)
    activity_visibility = Column(String(20), default="everyone", nullable=False)
    content_visibility = Column(String(20), default="everyone", nullable=False)

    @property
    def is_verified(self):
        return bool(self.verified_at and (self.verification_expires_at is None or self.verification_expires_at.replace(tzinfo=None) > utcnow_naive()))

    @property
    def is_frozen(self):
        return bool(self.frozen_at and (self.frozen_until is None or self.frozen_until.replace(tzinfo=None) > utcnow_naive()))


    # وسائل تحقق اختيارية؛ أسرار TOTP تحفظ مشفرة ولا تعاد في استجابات API.
    phone_number = Column(String(20), nullable=True)
    phone_verified = Column(Boolean, default=False, nullable=False)
    email_otp_enabled = Column(Boolean, default=False, nullable=False)
    sms_otp_enabled = Column(Boolean, default=False, nullable=False)
    totp_secret = Column(String(512), nullable=True)
    pending_totp_secret = Column(String(512), nullable=True)
    totp_last_step = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    posts = relationship("Post", back_populates="author", cascade="all, delete-orphan")
    comments = relationship("Comment", back_populates="author", cascade="all, delete-orphan")
    likes = relationship("Like", back_populates="user", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_users_username_lower", "username"),
    )


class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(Text, nullable=True)
    image_url = Column(String(255), nullable=True)
    video_url = Column(String(255), nullable=True)
    mood_key = Column(String(20), nullable=True)
    # سياق اختياري يربط المنشور بدائرة أو تحدٍ أو صفحة أعمال؛ يبقى None للمحتوى القديم.
    circle_id = Column(Integer, ForeignKey("circles.id", ondelete="SET NULL"), nullable=True, index=True)
    challenge_id = Column(Integer, ForeignKey("challenges.id", ondelete="SET NULL"), nullable=True, index=True)
    business_id = Column(Integer, ForeignKey("business_pages.id", ondelete="SET NULL"), nullable=True, index=True)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    is_edited = Column(Boolean, default=False, nullable=False)
    is_archived = Column(Boolean, default=False, nullable=False, index=True)

    author = relationship("User", back_populates="posts")
    comments = relationship("Comment", back_populates="post", cascade="all, delete-orphan")
    likes = relationship("Like", back_populates="post", cascade="all, delete-orphan")


class Comment(Base):
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(String(500), nullable=False)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)

    post = relationship("Post", back_populates="comments")
    author = relationship("User", back_populates="comments")


class Like(Base):
    __tablename__ = "likes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    user = relationship("User", back_populates="likes")
    post = relationship("Post", back_populates="likes")

    __table_args__ = (
        UniqueConstraint("user_id", "post_id", name="uq_like_user_post"),
    )


class Follower(Base):
    """
    follower_id يتابع following_id
    """
    __tablename__ = "followers"

    id = Column(Integer, primary_key=True, index=True)
    follower_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    following_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    follower = relationship("User", foreign_keys=[follower_id])
    following = relationship("User", foreign_keys=[following_id])

    __table_args__ = (
        UniqueConstraint("follower_id", "following_id", name="uq_follow_pair"),
    )


class FollowRequest(Base):
    """Request to follow a private account; accepted follows remain Follower rows."""
    __tablename__ = "follow_requests"
    id = Column(Integer, primary_key=True, index=True)
    requester_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    target_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(20), default="pending", nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    requester = relationship("User", foreign_keys=[requester_id])
    target = relationship("User", foreign_keys=[target_id])
    __table_args__ = (UniqueConstraint("requester_id", "target_id", name="uq_follow_request_pair"),)


class NotificationType(str, enum.Enum):
    follow = "follow"
    like = "like"
    comment = "comment"


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    recipient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(SAEnum(NotificationType), nullable=False)

    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=True)
    comment_id = Column(Integer, ForeignKey("comments.id", ondelete="CASCADE"), nullable=True)

    is_read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)

    recipient = relationship("User", foreign_keys=[recipient_id])
    actor = relationship("User", foreign_keys=[actor_id])


class ReportTargetType(str, enum.Enum):
    user = "user"
    post = "post"
    comment = "comment"
    reel = "reel"
    story = "story"
    message = "message"


class ReportStatus(str, enum.Enum):
    pending = "pending"
    reviewed = "reviewed"
    dismissed = "dismissed"


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    target_type = Column(SAEnum(ReportTargetType), nullable=False)
    target_id = Column(Integer, nullable=False)
    reason = Column(String(500), nullable=False)
    category = Column(String(30), nullable=False, default="other")
    reviewer_id = Column(Integer, nullable=True)
    review_note = Column(String(1000), nullable=True)
    resolution = Column(String(30), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    target_snapshot = Column(Text, nullable=True)
    target_fingerprint = Column(String(120), nullable=True)
    status = Column(SAEnum(ReportStatus), default=ReportStatus.pending, nullable=False, index=True)

    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    reporter = relationship("User", foreign_keys=[reporter_id])
    # ==================== V2: الدردشة والمزاج ====================

class ModerationAudit(Base):
    """سجل مستقل لا تُحذف آثاره عند حذف حساب أو محتوى."""
    __tablename__ = "moderation_audit"
    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, nullable=False, index=True)
    action = Column(String(40), nullable=False)
    target_type = Column(String(20), nullable=False)
    target_id = Column(Integer, nullable=False)
    report_id = Column(Integer, nullable=True)
    note = Column(String(1000), nullable=False, default="")
    details = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    user1_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    user2_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow_naive)
    last_message_at = Column(DateTime, default=utcnow_naive, index=True)
    # Optional community context; legacy conversations remain readable.
    circle_id = Column(Integer, ForeignKey("circles.id", ondelete="SET NULL"), nullable=True, index=True)

    __table_args__ = (
        UniqueConstraint("user1_id", "user2_id", name="uq_conversation_pair"),
    )

    user1 = relationship("User", foreign_keys=[user1_id])
    user2 = relationship("User", foreign_keys=[user2_id])
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    sender_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    content = Column(String(2000), nullable=False)
    is_read = Column(Boolean, default=False, index=True)
    created_at = Column(DateTime, default=utcnow_naive, index=True)

    conversation = relationship("Conversation", back_populates="messages")
    sender = relationship("User")


class Mood(Base):
    __tablename__ = "moods"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(30), unique=True, nullable=False)
    label_ar = Column(String(50), nullable=False)
    emoji = Column(String(10), nullable=False)
    color = Column(String(20), nullable=False)


class MoodStatus(Base):
    __tablename__ = "mood_status"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    mood_id = Column(Integer, ForeignKey("moods.id"), nullable=False)
    note = Column(String(120), nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)

    user = relationship("User")
    mood = relationship("Mood")


# ==================== V3: القصص المؤقتة ومقاطع Reels ====================
class Story(Base):
    __tablename__ = "stories"

    id = Column(Integer, primary_key=True, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    caption = Column(String(500), nullable=True)
    image_url = Column(String(255), nullable=True)
    video_url = Column(String(255), nullable=True)
    mood_key = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    is_archived = Column(Boolean, default=False, nullable=False, index=True)

    author = relationship("User")
    views = relationship("StoryView", back_populates="story", cascade="all, delete-orphan")


class StoryView(Base):
    __tablename__ = "story_views"

    id = Column(Integer, primary_key=True, index=True)
    story_id = Column(Integer, ForeignKey("stories.id", ondelete="CASCADE"), nullable=False, index=True)
    viewer_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    viewed_at = Column(DateTime, default=utcnow_naive, nullable=False)

    story = relationship("Story", back_populates="views")
    viewer = relationship("User")
    __table_args__ = (UniqueConstraint("story_id", "viewer_id", name="uq_story_viewer"),)


class Reel(Base):
    __tablename__ = "reels"

    id = Column(Integer, primary_key=True, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    caption = Column(String(500), nullable=True)
    video_url = Column(String(255), nullable=False)
    mood_key = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False, index=True)

    author = relationship("User")
    likes = relationship("ReelLike", back_populates="reel", cascade="all, delete-orphan")
    views = relationship("ReelView", back_populates="reel", cascade="all, delete-orphan")


class ReelLike(Base):
    __tablename__ = "reel_likes"

    id = Column(Integer, primary_key=True, index=True)
    reel_id = Column(Integer, ForeignKey("reels.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    reel = relationship("Reel", back_populates="likes")
    user = relationship("User")
    __table_args__ = (UniqueConstraint("reel_id", "user_id", name="uq_reel_like_user"),)


class ReelView(Base):
    __tablename__ = "reel_views"

    id = Column(Integer, primary_key=True, index=True)
    reel_id = Column(Integer, ForeignKey("reels.id", ondelete="CASCADE"), nullable=False, index=True)
    viewer_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    viewed_at = Column(DateTime, default=utcnow_naive, nullable=False)

    reel = relationship("Reel", back_populates="views")
    viewer = relationship("User")
    __table_args__ = (UniqueConstraint("reel_id", "viewer_id", name="uq_reel_viewer"),)


class OtpChallenge(Base):
    """تحدٍ أحادي الاستخدام لرمز الدخول أو تفعيل وسيلة تحقق."""
    __tablename__ = "otp_challenges"

    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    purpose = Column(String(24), nullable=False, index=True)
    method = Column(String(12), nullable=False)
    target = Column(String(255), nullable=True)
    code_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    last_sent_at = Column(DateTime, nullable=True)
    attempts = Column(Integer, default=0, nullable=False)
    sends_count = Column(Integer, default=0, nullable=False)
    consumed = Column(Boolean, default=False, nullable=False)

    user = relationship("User")


# ==================== دوائر Ytrana ====================
class Circle(Base):
    __tablename__ = "circles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, index=True)
    description = Column(String(1000), nullable=False, default="")
    image_url = Column(String(255), nullable=True)
    cover_url = Column(String(255), nullable=True)
    is_private = Column(Boolean, nullable=False, default=False)
    is_archived = Column(Boolean, nullable=False, default=False, index=True)
    creator_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    pinned_post_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False, index=True)

    creator = relationship("User")
    memberships = relationship("CircleMembership", back_populates="circle", cascade="all, delete-orphan")


class CircleMembership(Base):
    __tablename__ = "circle_memberships"

    id = Column(Integer, primary_key=True, index=True)
    circle_id = Column(Integer, ForeignKey("circles.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(16), nullable=False, default="member")  # owner | moderator | member
    # JSON list in Text for SQLite/PostgreSQL portability; moderators default to least privilege.
    capabilities = Column(Text, nullable=False, default="[]")
    status = Column(String(16), nullable=False, default="active")  # active | pending
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    circle = relationship("Circle", back_populates="memberships")
    user = relationship("User")
    __table_args__ = (UniqueConstraint("circle_id", "user_id", name="uq_circle_member"),)


class CircleDMRequest(Base):
    """Member request for owner approval of a pair DM in a circle."""
    __tablename__ = "circle_dm_requests"
    id = Column(Integer, primary_key=True, index=True)
    circle_id = Column(Integer, ForeignKey("circles.id", ondelete="CASCADE"), nullable=False, index=True)
    requester_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    recipient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(16), nullable=False, default="pending")  # pending | approved | revoked
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)
    requester = relationship("User", foreign_keys=[requester_id])
    recipient = relationship("User", foreign_keys=[recipient_id])
    __table_args__ = (UniqueConstraint("circle_id", "requester_id", "recipient_id", name="uq_circle_dm_request_pair"),)


class CircleDMApproval(Base):
    """Explicit owner approval for member-to-member DMs in a circle."""
    __tablename__ = "circle_dm_approvals"

    id = Column(Integer, primary_key=True, index=True)
    circle_id = Column(Integer, ForeignKey("circles.id", ondelete="CASCADE"), nullable=False, index=True)
    requester_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    recipient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    approved_by = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(16), nullable=False, default="active")  # active | revoked
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    __table_args__ = (UniqueConstraint("circle_id", "requester_id", "recipient_id", name="uq_circle_dm_pair"),)


# ==================== تحديات Ytrana ====================
class Challenge(Base):
    __tablename__ = "challenges"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(120), nullable=False)
    description = Column(String(2000), nullable=False, default="")
    image_url = Column(String(255), nullable=True)
    period = Column(String(10), nullable=False, default="weekly")  # daily | weekly
    starts_at = Column(DateTime, nullable=False, index=True)
    ends_at = Column(DateTime, nullable=False, index=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False, index=True)

    creator = relationship("User")


class ChallengeAchievement(Base):
    __tablename__ = "challenge_achievements"

    id = Column(Integer, primary_key=True, index=True)
    challenge_id = Column(Integer, ForeignKey("challenges.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    badge = Column(String(80), nullable=False, default="مشارك في التحدي")
    earned_at = Column(DateTime, default=utcnow_naive, nullable=False)

    challenge = relationship("Challenge")
    user = relationship("User")
    __table_args__ = (UniqueConstraint("challenge_id", "user_id", name="uq_challenge_achievement"),)


# ==================== صفحات Ytrana Business ====================
class BusinessPage(Base):
    __tablename__ = "business_pages"

    id = Column(Integer, primary_key=True, index=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    name = Column(String(120), nullable=False, index=True)
    description = Column(String(2000), nullable=False, default="")
    image_url = Column(String(255), nullable=True)
    cover_url = Column(String(255), nullable=True)
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(30), nullable=True)
    website_url = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False, index=True)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    owner = relationship("User")
    products = relationship("BusinessProduct", back_populates="page", cascade="all, delete-orphan")


class BusinessFollow(Base):
    __tablename__ = "business_follows"

    id = Column(Integer, primary_key=True, index=True)
    page_id = Column(Integer, ForeignKey("business_pages.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    page = relationship("BusinessPage")
    user = relationship("User")
    __table_args__ = (UniqueConstraint("page_id", "user_id", name="uq_business_follow"),)


class BusinessProduct(Base):
    __tablename__ = "business_products"

    id = Column(Integer, primary_key=True, index=True)
    page_id = Column(Integer, ForeignKey("business_pages.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    description = Column(String(2000), nullable=False, default="")
    image_url = Column(String(255), nullable=True)
    price = Column(String(32), nullable=True)  # سعر وصفي اختياري؛ لا يوجد دفع أو checkout.
    created_at = Column(DateTime, default=utcnow_naive, nullable=False, index=True)
    updated_at = Column(DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False)

    page = relationship("BusinessPage", back_populates="products")


class BusinessPageView(Base):
    __tablename__ = "business_page_views"

    id = Column(Integer, primary_key=True, index=True)
    page_id = Column(Integer, ForeignKey("business_pages.id", ondelete="CASCADE"), nullable=False, index=True)
    viewer_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)

    page = relationship("BusinessPage")
    viewer = relationship("User")
    __table_args__ = (UniqueConstraint("page_id", "viewer_id", name="uq_business_viewer"),)
