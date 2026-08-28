"""
سكربت سطر أوامر لترقية مستخدم موجود إلى صلاحية Admin.
لا يوجد أي مسار API عام لإنشاء admin عمدًا لأسباب أمنية —
هذه العملية تتم فقط يدويًا من طرف صاحب الخادم.

الاستخدام:
    cd backend
    python create_admin.py <username>
"""
import sys

from database.db import SessionLocal
from models import models  # noqa: F401
from models.models import User


def main():
    if len(sys.argv) != 2:
        print("الاستخدام: python create_admin.py <username>")
        sys.exit(1)

    username = sys.argv[1].strip().lower()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            print(f"لا يوجد مستخدم باسم '{username}'")
            sys.exit(1)
        user.is_admin = True
        db.commit()
        print(f"تم منح صلاحية الإدارة للمستخدم '{username}' بنجاح.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
