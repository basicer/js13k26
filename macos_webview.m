#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

extern unsigned char dist_index_html[];
extern unsigned int dist_index_html_len;

@interface AppDelegate : NSObject <NSApplicationDelegate>
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
	NSWindow *window = [[NSWindow alloc]
		initWithContentRect:NSMakeRect(0, 0, 960, 640)
		styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
			NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
		backing:NSBackingStoreBuffered
		defer:NO];
	window.title = @"js13k26";
	[window center];

	WKWebView *webView = [[WKWebView alloc] initWithFrame:window.contentView.bounds];
	webView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
	webView.inspectable = YES;
	[webView.configuration.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
	[window.contentView addSubview:webView];

	NSData *html = [NSData dataWithBytes:dist_index_html length:dist_index_html_len];
	[webView loadData:html
		MIMEType:@"text/html"
		characterEncodingName:@"utf-8"
		baseURL:[NSURL fileURLWithPath:@"/" isDirectory:YES]];
	[window makeKeyAndOrderFront:nil];
}

@end

int main(int argc, const char *argv[]) {
	@autoreleasepool {
		NSApplication *app = NSApplication.sharedApplication;
		app.delegate = AppDelegate.new;
		[app run];
	}
	return 0;
}
