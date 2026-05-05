import importlib.util, sys                                                                                                            
from pathlib import Path                                        

NETWORKIDLE_EXCLUDED_URL_PATTERNS = [                                                                                                 
    "challenges.cloudflare.com","google.com/recaptcha","www.gstatic.com/recaptcha",
    "hcaptcha.com","api.funcaptcha.com","client-api.arkoselabs.com",                                                                  
    "google-analytics.com","googletagmanager.com","analytics.google.com",                                                             
    "hotjar.com","fullstory.com","logrocket.com","mouseflow.com","clarity.ms",                                                        
    "browser-intake-datadoghq.com","sentry.io","newrelic.com","nr-data.net",                                                          
    "forter.com","/heartbeat","/keepalive","/keep-alive","/beacon",                                                                   
]                                                                                                                                     
PATCH_MARKER = "/* networkidle-exclusion-list */"                                                                                     
PATCH_SNIPPET = (                                                                                                                     
    f'    {PATCH_MARKER}\n'                                     
    f'    const _reqUrl = request.url();\n'                                                                                           
    f'    if ({NETWORKIDLE_EXCLUDED_URL_PATTERNS!r}.some(p => _reqUrl.includes(p))) return;\n'                                        
).replace("'", '"')                                                                                                                   
                                                                                                                                    
VANILLA_STARTED = (                                                                                                                   
    "  _inflightRequestStarted(request) {\n    const frame = request.frame();\n"                                                      
    "    if (request._isFavicon)\n      return;\n"                                                                                    
)                                                                                                                                     
PATCHED_STARTED = VANILLA_STARTED + PATCH_SNIPPET                                                                                     
VANILLA_FINISHED = (                                                                                                                  
    "  _inflightRequestFinished(request) {\n    const frame = request.frame();\n"
    "    if (request._isFavicon)\n      return;\n"                                                                                    
)                                                                                                                                     
PATCHED_FINISHED = VANILLA_FINISHED + PATCH_SNIPPET
                                                                                                                                    
def driver_frames_path():                                                                                                             
    spec = importlib.util.find_spec("patchright")
    return Path(spec.origin).parent / "driver" / "package" / "lib" / "server" / "frames.js"                                           
                                                                                                                                    
def apply():
    p = driver_frames_path(); src = p.read_text()                                                                                     
    if PATCH_MARKER in src: print(f"already patched: {p}"); return                                                                    
    if VANILLA_STARTED not in src or VANILLA_FINISHED not in src:                                                                     
        raise SystemExit("could not locate vanilla _inflightRequest* methods")                                                        
    p.write_text(src.replace(VANILLA_STARTED, PATCHED_STARTED, 1).replace(VANILLA_FINISHED, PATCHED_FINISHED, 1))                     
    print(f"patched: {p}")                                                                                                            
                                                                                                                                    
def revert():                                                                                                                         
    p = driver_frames_path(); src = p.read_text()               
    if PATCH_MARKER not in src: print(f"already vanilla: {p}"); return                                                                
    p.write_text(src.replace(PATCHED_STARTED, VANILLA_STARTED, 1).replace(PATCHED_FINISHED, VANILLA_FINISHED, 1))                     
    print(f"reverted: {p}")                                                                                                           
                                                                                                                                    
if __name__ == "__main__":                                                                                                            
    cmd = sys.argv[1] if len(sys.argv) > 1 else "apply"         
    {"apply": apply, "revert": revert}[cmd]()          