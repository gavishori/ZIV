# ZIV: פיכמן 5, הוצאות והכנסות

אפליקציית ווב שמחליפה את קובץ האקסל של הדירה בפיכמן 5: תשלומי הדיירים (ועד, מים, חשמל), ההכנסות (שכ״ד) וההוצאות, ומצב החשבון.

**כתובת:** <https://gavishori.github.io/ZIV/> (כניסה עם חשבון Google מורשה בלבד)

## איך זה בנוי

```
index.html, style.css, app.js   האפליקציה (GitHub Pages מהענף main)
firebase-config.js              הגדרות פרויקט Firebase ziv-pichman5 (ציבוריות מטבען)
firestore.rules                 מי מורשה לקרוא ולכתוב
```

**הנתונים לא נמצאים בריפו**, כי הוא ציבורי. הם שמורים ב-Firestore באוסף `entries`, רשומה לכל שורה:
`kind` (`tenant` לתשלומי דיירים, `ledger` להכנסות והוצאות), `date` (YYYY-MM-DD), `cat`, `desc`, `amount` (בהכנסות והוצאות: הכנסה בפלוס, הוצאה במינוס), `open` (דורש טיפול).

**מצב החשבון** מחושב כמו באקסל: סכום ההכנסות וההוצאות פחות סכום תשלומי הדיירים.

## שימוש

- **הוספה ועריכה:** ״+ הוספה״, או לחיצה על שורה.
- **ייבוא מאקסל:** בוחרים את קובץ האקסל בפורמט הישן (תשלומי דיירים בעמודות A-D, הכנסות והוצאות בעמודות F-H, מהשורה החמישית). הייבוא מחליף את כל הרשומות הקיימות.
- **ייצוא לאקסל:** קובץ גיבוי עם גיליון לכל טבלה.
- **שיתוף** (לבעלים בלבד): הוספה או הסרה של כתובות Gmail. מי שברשימה רואה ועורך הכול.

## הגדרה חד-פעמית ב-Firebase Console (פרויקט ziv-pichman5)

1. **Firestore Database** ← Create database (מיקום `eur3`, מצב production).
2. **Authentication** ← Get started ← Sign-in method ← להפעיל **Google**.
3. **Authentication** ← Settings ← Authorized domains ← להוסיף `gavishori.github.io`.
4. לפרוס את חוקי האבטחה (גם אחרי כל שינוי ב-`firestore.rules`):
   ```
   npx firebase-tools deploy --only firestore:rules
   ```

אחרי שינוי ב-`app.js` או ב-`style.css` מעלים את `?v=N` בקישור שלהם ב-`index.html`, כדי שהדפדפן לא יטען גרסה ישנה.
