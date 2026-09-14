"""
مسارات الدردشة (Messages) — محادثات ثنائية بين المستخدمين.
شبه فورية عبر Polling (الفرونت إند يسأل كل بضع ثوانٍ).
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session

from database.db import get_db
from middleware.auth_dependency import get_current_user
from models.models import User, Conversation, Message
from schemas.schemas import MessageCreate, MessageOut, ConversationOut

router = APIRouter(prefix="/api/messages", tags=["Messages"])


def _get_or_create_conversation(db: Session, user_a_id: int, user_b_id: int) -> Conversation:
    low, high = sorted([user_a_id, user_b_id])
    conv = (
        db.query(Conversation)
        .filter(Conversation.user1_id == low, Conversation.user2_id == high)
        .first()
    )
    if conv:
        return conv
    conv = Conversation(user1_id=low, user2_id=high)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


@router.get("", response_model=list[ConversationOut])
def list_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """قائمة كل محادثات المستخدم الحالي، مرتبة بآخر رسالة."""
    convs = (
        db.query(Conversation)
        .filter(
            or_(
                Conversation.user1_id == current_user.id,
                Conversation.user2_id == current_user.id,
            )
        )
        .order_by(Conversation.last_message_at.desc())
        .all()
    )

    result = []
    for conv in convs:
        other = conv.user2 if conv.user1_id == current_user.id else conv.user1
        last_msg = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .first()
        )
        unread = (
            db.query(Message)
            .filter(
                Message.conversation_id == conv.id,
                Message.sender_id != current_user.id,
                Message.is_read == False,  # noqa: E712
            )
            .count()
        )
        result.append(
            ConversationOut(
                id=conv.id,
                other_user=other,
                last_message=last_msg.content if last_msg else None,
                last_message_at=last_msg.created_at if last_msg else conv.created_at,
                unread_count=unread,
            )
        )
    return result


@router.get("/unread-count")
def unread_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv_ids = [
        c.id
        for c in db.query(Conversation)
        .filter(
            or_(
                Conversation.user1_id == current_user.id,
                Conversation.user2_id == current_user.id,
            )
        )
        .all()
    ]
    if not conv_ids:
        return {"unread_count": 0}
    count = (
        db.query(Message)
        .filter(
            Message.conversation_id.in_(conv_ids),
            Message.sender_id != current_user.id,
            Message.is_read == False,  # noqa: E712
        )
        .count()
    )
    return {"unread_count": count}


@router.get("/{username}", response_model=list[MessageOut])
def get_conversation_messages(
    username: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """رسائل المحادثة مع مستخدم معيّن، وتُعلَّم رسائله كمقروءة تلقائيًا."""
    other = db.query(User).filter(User.username == username.lower()).first()
    if not other:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المستخدم غير موجود")
    if other.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="لا يمكنك مراسلة نفسك")

    conv = _get_or_create_conversation(db, current_user.id, other.id)

    messages = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id)
        .order_by(Message.created_at.asc())
        .all()
    )

    db.query(Message).filter(
        Message.conversation_id == conv.id,
        Message.sender_id == other.id,
        Message.is_read == False,  # noqa: E712
    ).update({"is_read": True})
    db.commit()

    return messages


@router.post("/{username}", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_message(
    username: str,
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    other = db.query(User).filter(User.username == username.lower()).first()
    if not other:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="المستخدم غير موجود")
    if other.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="لا يمكنك مراسلة نفسك")

    conv = _get_or_create_conversation(db, current_user.id, other.id)

    message = Message(
        conversation_id=conv.id,
        sender_id=current_user.id,
        content=payload.content,
    )
    db.add(message)
    conv.last_message_at = datetime.utcnow()
    db.commit()
    db.refresh(message)
    return message
