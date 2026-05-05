import sys, time                                                                                                                      
from importlib.metadata import version as pkg_version
from typing import Optional                                                                                                           
from patchright.sync_api import sync_playwright                                                                                       
from server import get_heartbeat_count, reset_heartbeat_count, serve
                                                                                                                                    
URL = "http://127.0.0.1:8765/"                                  
NETWORKIDLE_TIMEOUT_MS = 15_000                                                                                                       
                                                                                                                                    
def main(label):
    print(f"=== {label} | patchright {pkg_version('patchright')} ===")                                                                
    serve(); time.sleep(0.2)                                                                                                          
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)                                                                                    
        page = browser.new_context().new_page()                                                                                       
        t0 = time.monotonic()
        page.goto(URL, wait_until="load")                                                                                             
        print(f"page load complete in {(time.monotonic()-t0)*1000:.0f} ms")                                                           
        reset_heartbeat_count()
        time.sleep(3)                                                                                                                 
        c = get_heartbeat_count()                               
        print(f"/heartbeat requests received in 3s after load: {c} (~{c/3:.1f}/sec)")                                                 
        t1 = time.monotonic()                                                                                                         
        err: Optional[str] = None
        try:                                                                                                                          
            page.wait_for_load_state("networkidle", timeout=NETWORKIDLE_TIMEOUT_MS)
        except Exception as exc:                                                                                                      
            err = type(exc).__name__ + ": " + str(exc).splitlines()[0]
        elapsed = (time.monotonic() - t1) * 1000                                                                                      
        print(f"networkidle: {'TIMED OUT after' if err else 'fired after'} {elapsed:.0f} ms"                                          
            + (f" — {err}" if err else ""))                                                                                         
        browser.close()                                                                                                               
                                                                                                                                    
if __name__ == "__main__":                                      
    main(sys.argv[1] if len(sys.argv) > 1 else "run")    