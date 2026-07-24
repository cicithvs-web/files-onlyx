# Contract mismatches found (frontend/NOTES/test vs actual backend)

Backend actual:
1. POST /api/repos -> ok(c,{id}) — frontend/test expect { repo: {...} }  => FIX BACKEND: return { repo } full row
2. POST /api/nodes -> ok(c,{id,path}) — frontend/test expect { node: {...} } => FIX BACKEND: return { node } full row
3. Auth profile endpoints:
   - actual: PATCH /api/auth/me; POST /api/auth/me/password {current_password,new_password}; PATCH /api/auth/me/settings
   - frontend uses: PATCH /api/auth/profile {display_name}; POST /api/auth/password {old_password,new_password}; PUT /api/auth/settings
   => FIX BACKEND: add aliases /profile (PATCH), /password (POST accepts old_password too), /settings (PUT) — keep old ones too
4. users PATCH status: backend uses 'disabled'; frontend uses 'suspended' => FIX BACKEND to accept both ('suspended'->'disabled')? Frontend AdminUsers sends 'suspended', displays u.status==='active' else Ditangguhkan. Simplest: backend treats any non-'active' as disabled; and frontend keep. Also login blocks status==='disabled' only => make login check status !== 'active'.
5. POST /api/repos/:id/duplicate exists — test 404 was due to empty REPO_ID (test parsing). OK.
6. Shares public list breadcrumbs: frontend SharePublic expects data.breadcrumbs — backend doesn't return => FIX BACKEND: add breadcrumbs array (ancestors of parent_id within share subtree).
7. Public share ZIP download: frontend uses GET /api/shares/public/:token/download (repo or folder as zip), with ?pw= param. Backend has no such route; password via query param named 'password' not 'pw' => FIX BACKEND: add /public/:token/download route (zip of repo/folder), and accept 'pw' query alias.
8. SharePublic download file uses ?pw= => accept pw alias in checkSharePassword.
9. Test script issues (not backend bugs): repo duplicate name (needs unique names/reset), unauthenticated python3 parse of data.repo.id — fix test to read data.id.
10. Search endpoint returns {repos,nodes} both arrays — ok. Test failed because nodes empty (nodes created failed earlier).
11. Frontend Settings.tsx uses api('/api/auth/settings', PUT) and body {...settings, patch} — will match new alias.
12. Frontend AdminUsers PATCH sends username, display_name, role, quota_bytes, status; backend supports. status 'suspended' mapping needed.
13. Frontend uses user.status === 'active'; 'suspended' badge otherwise. Backend stores 'disabled'. Keep stored value 'suspended'? Spec used suspended? Choose: store what's sent: map 'suspended'->'suspended', block login when status !== 'active'. Update requireAuth check too (currently checks 'disabled').
    => Simplest robust: backend treats status !== 'active' as blocked everywhere; PATCH stores 'suspended' if body says suspended else 'active'|'disabled' passthrough.
14. Frontend Storage/AdminUsers expect users fields quota_bytes, storage_used_bytes — present.
15. GET /api/dashboard returns repo_count etc. — check Dashboard.tsx expectations later if mismatch. (test passed)
16. Trash restore/delete-forever contract matches {item_type,id}. Test failures cascade from earlier failures.
17. uploader.ts: verify it sends form fields repo_id, parent_id, relative_path, file for direct; init payload matches. CHECK.
18. Editor/Explorer expectations: node content GET returns raw body; PUT accepts raw body — matches.
