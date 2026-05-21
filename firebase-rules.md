# Firebase Security Rules

## วิธีตั้งค่า
1. ไปที่ Firebase Console → project ของคุณ
2. ไปที่ Realtime Database → Rules แล้ววางนี้:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": true,
        ".write": true,
        "players": {
          "$playerName": {
            ".validate": "newData.hasChildren(['joinedAt', 'online'])"
          }
        },
        "chat": {
          "$msgId": {
            ".validate": "newData.hasChildren(['player', 'text', 'time']) && newData.child('text').val().length < 500"
          }
        }
      }
    },
    "saves": {
      "$userId": {
        ".read": true,
        ".write": true
      }
    },
    "room-saves": {
      "$roomId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

> **หมายเหตุ:** ทุกอย่างเก็บใน Realtime Database (ฟรี 1GB)
> ไม่ต้องใช้ Firebase Storage เลย
