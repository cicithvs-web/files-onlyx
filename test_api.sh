#!/bin/bash
# End-to-end API test for Files Onlyx worker
BASE="${1:-http://127.0.0.1:8787}"
CJ=/tmp/cj.txt
PASS=0; FAIL=0

check() {
  local desc="$1"; local expect="$2"; local actual="$3"
  if echo "$actual" | grep -q "$expect"; then
    PASS=$((PASS+1)); echo "PASS: $desc"
  else
    FAIL=$((FAIL+1)); echo "FAIL: $desc"; echo "  expected: $expect"; echo "  actual:   $(echo "$actual" | head -c 300)"
  fi
}

# 1. login
R=$(curl -s -c $CJ -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"Onlyx@Admin2026!","remember":true}')
check "login" '"success":true' "$R"

# 2. me
R=$(curl -s -b $CJ $BASE/api/auth/me)
check "auth/me" '"username":"admin"' "$R"

# 3. create repo
TS=$(date +%s)
R=$(curl -s -b $CJ -X POST $BASE/api/repos -H 'Content-Type: application/json' -d "{\"name\":\"test-repo-$TS\",\"description\":\"repo uji\",\"color\":\"#7c6cf0\",\"is_public\":false}")
check "create repo" '"success":true' "$R"
REPO_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
echo "  repo_id=$REPO_ID"

# 4. list repos
R=$(curl -s -b $CJ $BASE/api/repos)
check "list repos" "test-repo-$TS" "$R"

# 5. create folder
R=$(curl -s -b $CJ -X POST $BASE/api/nodes -H 'Content-Type: application/json' -d "{\"repo_id\":\"$REPO_ID\",\"parent_id\":null,\"type\":\"folder\",\"name\":\"src\"}")
check "create folder" '"success":true' "$R"
FOLDER_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)

# 6. create file
R=$(curl -s -b $CJ -X POST $BASE/api/nodes -H 'Content-Type: application/json' -d "{\"repo_id\":\"$REPO_ID\",\"parent_id\":\"$FOLDER_ID\",\"type\":\"file\",\"name\":\"main.ts\"}")
check "create file" '"success":true' "$R"
FILE_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)

# 7. write content
R=$(curl -s -b $CJ -X PUT $BASE/api/nodes/$FILE_ID/content -H 'Content-Type: text/plain' --data-binary 'console.log("halo dunia");')
check "write content" '"success":true' "$R"

# 8. read content
R=$(curl -s -b $CJ $BASE/api/nodes/$FILE_ID/content)
check "read content" 'halo dunia' "$R"

# 9. direct upload
echo "isi file upload test" > /tmp/up.txt
R=$(curl -s -b $CJ -X POST $BASE/api/uploads/direct -F "repo_id=$REPO_ID" -F "relative_path=docs/upload.txt" -F "file=@/tmp/up.txt")
check "direct upload with folder path" '"success":true' "$R"

# 10. chunked upload (1.2MB)
python3 -c "open('/tmp/big.bin','wb').write(bytes(range(256))*4915)"
SIZE=$(stat -c%s /tmp/big.bin)
R=$(curl -s -b $CJ -X POST $BASE/api/uploads/init -H 'Content-Type: application/json' -d "{\"repo_id\":\"$REPO_ID\",\"parent_id\":null,\"file_name\":\"big.bin\",\"file_size\":$SIZE,\"mime_type\":\"application/octet-stream\",\"chunk_size\":524288}")
check "upload init" '"session_id"' "$R"
SESSION=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['session_id'])" 2>/dev/null)
TOTAL=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['total_chunks'])" 2>/dev/null)
for i in $(seq 0 $((TOTAL-1))); do
  dd if=/tmp/big.bin of=/tmp/chunk.bin bs=524288 skip=$i count=1 2>/dev/null
  RC=$(curl -s -b $CJ -X PUT $BASE/api/uploads/$SESSION/chunk/$i --data-binary @/tmp/chunk.bin)
done
check "upload chunks" '"success":true' "$RC"
R=$(curl -s -b $CJ -X POST $BASE/api/uploads/$SESSION/complete)
check "upload complete" '"success":true' "$R"
BIG_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['node']['id'])" 2>/dev/null)
echo "  big_id=$BIG_ID"

# 11. download & verify checksum
curl -s -b $CJ -o /tmp/big_dl.bin $BASE/api/nodes/$BIG_ID/download
if [ "$(md5sum /tmp/big.bin | cut -d' ' -f1)" = "$(md5sum /tmp/big_dl.bin | cut -d' ' -f1)" ]; then
  PASS=$((PASS+1)); echo "PASS: chunked download checksum"
else
  FAIL=$((FAIL+1)); echo "FAIL: chunked download checksum"
fi

# 12. rename
R=$(curl -s -b $CJ -X PATCH $BASE/api/nodes/$FILE_ID/rename -H 'Content-Type: application/json' -d '{"name":"index.ts"}')
check "rename" '"success":true' "$R"

# 13. copy
R=$(curl -s -b $CJ -X POST $BASE/api/nodes/$FILE_ID/copy -H 'Content-Type: application/json' -d '{"duplicate":true}')
check "duplicate node" '"success":true' "$R"

# 14. move
R=$(curl -s -b $CJ -X PATCH $BASE/api/nodes/$FILE_ID/move -H 'Content-Type: application/json' -d '{"target_parent_id":null}')
check "move node" '"success":true' "$R"

# 15. favorite
R=$(curl -s -b $CJ -X PATCH $BASE/api/nodes/$FILE_ID/favorite -H 'Content-Type: application/json' -d '{"favorite":true}')
check "favorite" '"success":true' "$R"
R=$(curl -s -b $CJ $BASE/api/favorites)
check "favorites list" 'index.ts' "$R"

# 16. tree
R=$(curl -s -b $CJ $BASE/api/nodes/repo/$REPO_ID/tree)
check "tree" 'index.ts' "$R"

# 17. properties
R=$(curl -s -b $CJ $BASE/api/nodes/$FOLDER_ID/properties)
check "properties" '"folder_count"' "$R"

# 18. zip compress folder
R=$(curl -s -b $CJ -X POST $BASE/api/zip/compress/$FOLDER_ID)
check "zip compress" '"success":true' "$R"

# 19. zip download folder
HTTP=$(curl -s -b $CJ -o /tmp/folder.zip -w '%{http_code}' $BASE/api/zip/folder/$FOLDER_ID)
check "zip folder download" '200' "$HTTP"
python3 -c "import zipfile; z=zipfile.ZipFile('/tmp/folder.zip'); print('zipok', z.namelist())" 2>/dev/null && { PASS=$((PASS+1)); echo "PASS: zip valid"; } || { FAIL=$((FAIL+1)); echo "FAIL: zip valid"; }

# 20. find zip node & extract
R=$(curl -s -b $CJ $BASE/api/nodes/repo/$REPO_ID/tree)
ZIP_ID=$(echo "$R" | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']['nodes']
z=[n for n in d if n['name'].endswith('.zip')]
print(z[0]['id'] if z else '')" 2>/dev/null)
R=$(curl -s -b $CJ -X POST $BASE/api/zip/extract/$ZIP_ID)
check "zip extract" '"success":true' "$R"

# 21. share node with password
R=$(curl -s -b $CJ -X POST $BASE/api/shares -H 'Content-Type: application/json' -d "{\"target_type\":\"node\",\"target_id\":\"$FILE_ID\",\"password\":\"rahasia123\",\"expires_in_hours\":24}")
check "create share" '"token"' "$R"
TOKEN=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])" 2>/dev/null)

# 22. public share info (no auth)
R=$(curl -s $BASE/api/shares/public/$TOKEN)
check "public share info" '"needs_password":true' "$R"

# 23. verify wrong password
R=$(curl -s -X POST $BASE/api/shares/public/$TOKEN/verify -H 'Content-Type: application/json' -d '{"password":"salah"}')
check "wrong share password rejected" '"success":false' "$R"

# 24. verify correct password + download file
R=$(curl -s -X POST $BASE/api/shares/public/$TOKEN/verify -H 'Content-Type: application/json' -d '{"password":"rahasia123"}')
check "correct share password" '"success":true' "$R"
R=$(curl -s "$BASE/api/shares/public/$TOKEN/file/$FILE_ID?pw=rahasia123")
check "public file download" 'halo dunia' "$R"

# 25. share repo without password + list
R=$(curl -s -b $CJ -X POST $BASE/api/shares -H 'Content-Type: application/json' -d "{\"target_type\":\"repo\",\"target_id\":\"$REPO_ID\"}")
TOKEN2=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])" 2>/dev/null)
R=$(curl -s $BASE/api/shares/public/$TOKEN2/list)
check "public repo list" '"nodes"' "$R"

# 26. shares list
R=$(curl -s -b $CJ $BASE/api/shares)
check "shares list" '"shares"' "$R"

# 27. search
R=$(curl -s -b $CJ "$BASE/api/search?q=index")
check "search" 'index.ts' "$R"

# 28. dashboard
R=$(curl -s -b $CJ $BASE/api/dashboard)
check "dashboard" '"repo_count"' "$R"

# 29. activities
R=$(curl -s -b $CJ "$BASE/api/activities?page=1")
check "activities" '"activities"' "$R"

# 30. delete node -> trash -> restore
R=$(curl -s -b $CJ -X DELETE $BASE/api/nodes/$FILE_ID)
check "delete node" '"success":true' "$R"
R=$(curl -s -b $CJ $BASE/api/trash)
check "trash list" 'index.ts' "$R"
R=$(curl -s -b $CJ -X POST $BASE/api/trash/restore -H 'Content-Type: application/json' -d "{\"item_type\":\"node\",\"id\":\"$FILE_ID\"}")
check "restore" '"success":true' "$R"

# 31. delete forever
R=$(curl -s -b $CJ -X DELETE $BASE/api/nodes/$BIG_ID)
R=$(curl -s -b $CJ -X POST $BASE/api/trash/delete-forever -H 'Content-Type: application/json' -d "{\"item_type\":\"node\",\"id\":\"$BIG_ID\"}")
check "delete forever" '"success":true' "$R"

# 32. user management
R=$(curl -s -b $CJ -X POST $BASE/api/users -H 'Content-Type: application/json' -d "{\"username\":\"tester$TS\",\"password\":\"Tester123!\",\"display_name\":\"Tester\",\"role\":\"user\",\"quota_bytes\":52428800}")
check "create user" '"success":true' "$R"
UID2=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
R=$(curl -s -b $CJ $BASE/api/users)
check "list users" "tester$TS" "$R"

# 33. login as tester & isolation check
R=$(curl -s -c /tmp/cj2.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"tester$TS\",\"password\":\"Tester123!\"}")
check "tester login" '"success":true' "$R"
R=$(curl -s -b /tmp/cj2.txt $BASE/api/repos/$REPO_ID)
check "isolation: tester cannot access admin repo" '"success":false' "$R"
R=$(curl -s -b /tmp/cj2.txt $BASE/api/users)
check "isolation: tester cannot list users" '"success":false' "$R"

# 34. patch user quota
R=$(curl -s -b $CJ -X PATCH $BASE/api/users/$UID2 -H 'Content-Type: application/json' -d '{"quota_bytes":104857600,"status":"suspended"}')
check "patch user" '"success":true' "$R"
R=$(curl -s -c /tmp/cj3.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"tester$TS\",\"password\":\"Tester123!\"}")
check "suspended user login blocked" '"success":false' "$R"

# 35. delete user
R=$(curl -s -b $CJ -X DELETE $BASE/api/users/$UID2)
check "delete user" '"success":true' "$R"

# 36. settings
R=$(curl -s -b $CJ -X PUT $BASE/api/auth/settings -H 'Content-Type: application/json' -d '{"theme":"night","accent_color":"#4cc9f0","language":"id"}')
check "save settings" '"success":true' "$R"
R=$(curl -s -b $CJ $BASE/api/auth/me)
check "settings persisted" 'night' "$R"

# 37. profile + password change endpoints
R=$(curl -s -b $CJ -X PATCH $BASE/api/auth/profile -H 'Content-Type: application/json' -d '{"display_name":"Admin Utama"}')
check "patch profile" '"success":true' "$R"
R=$(curl -s -b $CJ -X POST $BASE/api/auth/password -H 'Content-Type: application/json' -d '{"old_password":"Onlyx@Admin2026!","new_password":"Onlyx@Admin2026!"}')
check "change password" '"success":true' "$R"

# 38. refresh token flow
R=$(curl -s -b $CJ -c $CJ -X POST $BASE/api/auth/refresh)
check "refresh" '"success":true' "$R"

# 39. repo duplicate
R=$(curl -s -b $CJ -X POST $BASE/api/repos/$REPO_ID/duplicate)
check "repo duplicate" '"success":true' "$R"

# 40. quota enforcement: create tiny user and try oversized upload
R=$(curl -s -b $CJ -X POST $BASE/api/users -H 'Content-Type: application/json' -d "{\"username\":\"tiny$TS\",\"password\":\"Tiny12345!\",\"display_name\":\"Tiny\",\"role\":\"user\",\"quota_bytes\":10485760}")
TINY_ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
curl -s -c /tmp/cj4.txt -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d "{\"username\":\"tiny$TS\",\"password\":\"Tiny12345!\"}" > /dev/null
R=$(curl -s -b /tmp/cj4.txt -X POST $BASE/api/repos -H 'Content-Type: application/json' -d '{"name":"tiny-repo"}')
TREPO=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
R=$(curl -s -b /tmp/cj4.txt -X POST $BASE/api/uploads/init -H 'Content-Type: application/json' -d "{\"repo_id\":\"$TREPO\",\"file_name\":\"huge.bin\",\"file_size\":209715200,\"chunk_size\":524288}")
check "quota enforcement on init" '"success":false' "$R"
curl -s -b $CJ -X DELETE $BASE/api/users/$TINY_ID > /dev/null

# 41. logout
R=$(curl -s -b $CJ -c $CJ -X POST $BASE/api/auth/logout)
check "logout" '"success":true' "$R"
R=$(curl -s -b $CJ $BASE/api/auth/me)
check "me after logout unauthorized" '"success":false' "$R"

echo ""
echo "=========================================="
echo "TOTAL: PASS=$PASS FAIL=$FAIL"
