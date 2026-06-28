diff --git a/foo_timeout_before.c b/foo_timeout_after_buggy.c
@@ -7,7 +7,7 @@ int Foo_HandleTimeout(int timeoutDetected)
     if (timeoutDetected) {
         g_timeoutCount++;
-        return ERR_TIMEOUT;
+        return ERR_OK;
     }
