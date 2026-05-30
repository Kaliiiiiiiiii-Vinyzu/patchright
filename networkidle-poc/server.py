import http.server, socketserver, threading, time
from pathlib import Path                                                                                                              

PAGE = (Path(__file__).parent / "test_page.html").read_text()                                                                         
heartbeat_count = 0                                             
heartbeat_lock = threading.Lock()                                                                                                     
                                                                
def reset_heartbeat_count():                                                                                                          
    global heartbeat_count                                      
    with heartbeat_lock:
        heartbeat_count = 0                                                                                                           

def get_heartbeat_count():                                                                                                            
    with heartbeat_lock:                                        
        return heartbeat_count

class Handler(http.server.BaseHTTPRequestHandler):                                                                                    
    def do_GET(self):
        if self.path == "/" or self.path.startswith("/index"):                                                                        
            body = PAGE.encode()                                
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))                                                                        
            self.end_headers(); self.wfile.write(body); return
        if self.path.startswith("/heartbeat"):                                                                                        
            global heartbeat_count                              
            with heartbeat_lock:                                                                                                      
                heartbeat_count += 1                            
            time.sleep(0.6)  # 600ms response, 200ms client interval => always ≥1 inflight
            body = b'{"ok":true}'                                                                                                     
            self.send_response(200)                                                                                                   
            self.send_header("Content-Type", "application/json")                                                                      
            self.send_header("Content-Length", str(len(body)))                                                                        
            self.end_headers(); self.wfile.write(body); return  
        self.send_response(404); self.end_headers()                                                                                   
    def log_message(self, *a, **kw): return
                                                                                                                                    
class ReusableTCPServer(socketserver.ThreadingTCPServer):                                                                             
    allow_reuse_address = True                                                                                                        
                                                                                                                                    
def serve(port=8765):                                                                                                                 
    httpd = ReusableTCPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True                                                                                                       
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()                                                                                                                         
    return t