import io

from genericagent_browser_control.cli_output import print_json


def test_print_json_writes_utf8_even_when_text_stream_encoding_cannot_encode():
    buffer = io.BytesIO()
    stream = io.TextIOWrapper(buffer, encoding="gbk")

    print_json({"title": "Sparkles ✨"}, stream=stream)

    payload = buffer.getvalue().decode("utf-8")
    assert '"Sparkles ✨"' in payload
