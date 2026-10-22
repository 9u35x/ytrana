"""معاينة تفعيل إداري بمعرف ثابت؛ لا تُنفذ تلقائيًا عند التشغيل أو الترحيل.

بعد التحقق من الحسابين وتهيئة ADMIN_USER_IDS بمعرفين فقط:
    python create_admin.py 123         # معاينة فقط
    python create_admin.py 123 --apply # تعديل صريح في قاعدة البيئة الحالية
لا تستخدم handles أو أسماء العرض لاختيار الحساب المخول.
"""
import argparse
from database.db import SessionLocal
from models.models import User
from services.moderation import admin_ids


def main():
    parser = argparse.ArgumentParser(description="معاينة أو تفعيل حساب إداري بمعرف ثابت معتمد")
    parser.add_argument("user_id", type=int)
    parser.add_argument("--apply", action="store_true", help="تنفيذ التعديل؛ بدونها لا تكتب أي بيانات")
    args = parser.parse_args()
    allowed = admin_ids()
    if args.user_id not in allowed:
        parser.error("يجب تهيئة ADMIN_USER_IDS بمعرفين مختلفين موجبين؛ والمعرف المطلوب يجب أن يكون أحدهما")
    with SessionLocal() as db:
        accounts = db.query(User).filter(User.id.in_(allowed)).all()
        if len(accounts) != 2:
            parser.error("يجب أن يكون كلا الحسابين موجودًا في قاعدة البيانات الحالية")
        user = next(user for user in accounts if user.id == args.user_id)
        if not user.is_active or user.is_banned or user.is_frozen:
            parser.error("الحساب غير نشط أو محظور أو مجمد؛ راجع هويته وحالته يدويًا")
        print(f"ID={user.id}; username=@{user.username}; name={user.full_name}")
        if not args.apply:
            print("معاينة فقط؛ لم تتغير الصلاحيات. تحقق من الهوية قبل استخدام --apply.")
            return
        user.is_admin = True
        db.commit()
        print("تم تفعيل علامة الإدارة للحساب المعتمد.")


if __name__ == "__main__":
    main()
